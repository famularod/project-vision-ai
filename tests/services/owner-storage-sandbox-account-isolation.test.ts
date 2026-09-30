/**
 * Whole-app audit A1 (owner-approved 30 Sep 2026). H2: on a fresh install,
 * a sync that finished after a sign-out left the signed-out account's data
 * where the next sign-in claimed it as its own, so another account was handed
 * it, or the same account's saved work was replaced by it (its unsynced task
 * edit lost). M4: approved-report baselines, and (A9 #5) Talk history, were
 * kept outside the account sandbox and keyed by project name, so the next
 * account read them and overwrote them. Real OwnerStorageSandbox, SyncService
 * queue, FieldUpdateLocalPersistence, report snapshot repository and Talk
 * history keys; only the phone's storage is in memory and the network is a
 * local stub. (Scenarios from the audit reviewer's proof tests.)
 */
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
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

let releaseNetwork: () => void = () => undefined;
let networkRequests = 0;
(global as { fetch?: unknown }).fetch = jest.fn(async () => {
  networkRequests += 1;
  await new Promise<void>(resolve => { releaseNetwork = resolve; });
  throw new TypeError('Network request failed');
});
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation-a1.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'a1-anon-key-not-a-secret';
jest.setTimeout(60_000);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createOwnerStorageSandbox,
  isOwnerSensitiveCanonicalStorageKey,
  OWNER_STORAGE_QUARANTINE_PREFIX,
  OWNER_STORAGE_SANDBOX_JOURNAL_KEY,
  OWNER_STORAGE_SANDBOX_METADATA_KEY,
} from '../../services/OwnerStorageSandbox';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey } from '../../services/DAVEReportSnapshot';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { daveAskHistoryJournalStorageKey, daveAskHistoryStorageKey } from '../../services/DAVEAskConversation';

// Required, not imported: since owner answer Q16 this module loads SupabaseService,
// and a hoisted import would create the client before the project settings above
// are set (every sync pass here would then report "not configured").
const { loadDAVEReportSnapshot, saveDAVEReportSnapshot } =
  require('../../services/DAVEReportSnapshotRepository') as typeof import('../../services/DAVEReportSnapshotRepository');

const storage = AsyncStorage as unknown as Parameters<typeof createOwnerStorageSandbox>[0]['storage'];
const nsPrefix = (owner: string) => `@vitruvius/owner-storage-sandbox/owner/${owner}/value/`;

async function canonicalKeys() {
  return (await AsyncStorage.getAllKeys()).filter(isOwnerSensitiveCanonicalStorageKey).sort();
}
async function quarantines() {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(OWNER_STORAGE_QUARANTINE_PREFIX));
  return Promise.all(keys.map(async key => JSON.parse((await AsyncStorage.getItem(key)) as string) as {
    suspectedOwnerId: string | null; snapshot: Record<string, string>;
  }));
}
const task = (id: string) => ({
  id, projectName: 'Canopy B', locationName: '', taskName: 'Pour slab', startDate: '',
  finishDate: '2026-10-02', milestone: '', owner: 'A', contractor: '', percentComplete: 40,
  priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-30T08:05:00.000Z',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
});

describe('H2: data written after a sign-out is never claimed by the next sign-in', () => {
  it('fresh install: a sync pass that finishes after sign-out leaves the same owner\'s saved work intact', async () => {
    const { supabaseSecureAuthStorage } = require('../../services/SupabaseAuthStorage');
    await supabaseSecureAuthStorage.setItem('sb-isolation-a1-auth-token', JSON.stringify({
      access_token: 'access-a', refresh_token: 'refresh-a', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3000,
      user: { id: 'owner-a', aud: 'authenticated', email: 'owner-a@example.com', app_metadata: {}, user_metadata: {} },
    }));
    const SyncService = require('../../services/SyncService');
    const sandbox = createOwnerStorageSandbox({ storage });
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-a');

    await AsyncStorage.multiSet([
      ['projectPhotoUpdate.projects.v2', JSON.stringify([{ name: 'Canopy B' }])],
      ['projectPhotoUpdates.v2', JSON.stringify([{ id: 'update-a1', projectName: 'Canopy B', status: 'failed', photos: [] }])],
      ['projectPhotoUpdate.activeDraft.v2', JSON.stringify({ draft: { id: 'draft-1', notes: 'half-written caption' } })],
    ]);
    await SyncService.queueScheduleItemRecord(task('task-1'), false);
    const before = new Map((await AsyncStorage.multiGet(await canonicalKeys())) as [string, string][]);

    // The pending-changes pass is waiting on a slow network when A signs out.
    const pass = SyncService.uploadPendingChanges();
    for (let i = 0; i < 200 && networkRequests === 0; i += 1) await new Promise(r => setTimeout(r, 10));
    await sandbox.activateOwner(null);
    expect(await canonicalKeys()).toEqual([]);
    releaseNetwork();
    await pass.catch(() => undefined);
    const stray = await canonicalKeys();
    expect(stray.length).toBeGreaterThan(0); // the pass wrote its queue back while signed out

    await sandbox.activateOwner('owner-a');
    for (const [key, value] of before) {
      expect(await AsyncStorage.getItem(key)).toBe(value);
    }
    expect(JSON.parse((await AsyncStorage.getItem('projectVisionAI.syncQueue.v1')) as string)
      .map((item: { id: string }) => item.id)).toEqual(['schedule-item-task-1']);
    // The late write is set aside for owner-a, not deleted.
    const [kept] = await quarantines();
    expect(kept.suspectedOwnerId).toBe('owner-a');
    expect(Object.keys(kept.snapshot).sort()).toEqual(stray);
  });

  it('fresh install: the previous owner\'s late field-update save is not handed to the next account', async () => {
    const { createFieldUpdateLocalPersistence, prepareFieldUpdateStatusSave } = require('../../services/FieldUpdateLocalPersistence');
    const { reconcileFieldUpdateSyncResult } = require('../../services/FieldUpdateSyncGeneration');
    const sandbox = createOwnerStorageSandbox({ storage });
    const keys = {
      journal: 'projectPhotoUpdate.fieldUpdateTransaction.v1',
      updates: 'projectPhotoUpdates.v2',
      tombstones: 'projectPhotoUpdate.deletedUpdates.v1',
      draft: 'projectPhotoUpdate.activeDraft.v2',
    };
    const persistence = createFieldUpdateLocalPersistence({
      storage: AsyncStorage, keys, createTransactionId: () => `tx${Date.now()}${Math.floor(Math.random() * 1e6)}`,
      now: () => new Date().toISOString(), parseUpdate: (v: unknown) => v, parseTombstone: (v: unknown) => v,
    });

    // B used this phone first (fresh install), then signed out.
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-b');
    await AsyncStorage.multiSet([
      ['projectPhotoUpdate.projects.v2', JSON.stringify([{ name: 'Tower 2' }])],
      [keys.updates, JSON.stringify([{ id: 'update-b1', projectName: 'Tower 2', status: 'queued', photos: [] }])],
    ]);
    await sandbox.activateOwner(null);

    // A signs in, saves, and signs out while that update is still syncing.
    await sandbox.activateOwner('owner-a');
    const updateA1 = { id: 'update-a1', projectName: 'Canopy B', status: 'queued', notes: 'Crack at column C4', photos: [] };
    const updateA0 = { id: 'update-a0', projectName: 'Canopy B', status: 'sent', notes: 'Formwork done', photos: [] };
    await AsyncStorage.setItem(keys.updates, JSON.stringify([updateA1, updateA0]));
    await sandbox.activateOwner(null);
    await persistence.commit((snapshot: never) => prepareFieldUpdateStatusSave({
      snapshot, update: { ...updateA1, status: 'failed' }, expectedUpdate: updateA1,
      currentUpdates: [updateA1, updateA0], currentTombstones: [], keys,
      mergeVisibleUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      reconcile: reconcileFieldUpdateSyncResult,
    }));

    // B signs in next: B's own work, none of A's.
    await sandbox.activateOwner('owner-b');
    expect(JSON.parse((await AsyncStorage.getItem(keys.updates)) as string).map((u: { id: string }) => u.id))
      .toEqual(['update-b1']);
    expect(await AsyncStorage.getItem('projectPhotoUpdate.projects.v2')).toBe(JSON.stringify([{ name: 'Tower 2' }]));
    const [kept] = await quarantines();
    expect(kept.suspectedOwnerId).toBe('owner-a');
    expect(kept.snapshot[keys.updates]).toContain('update-a1');

    // A's own saved work is where A left it.
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-a');
    expect(JSON.parse((await AsyncStorage.getItem(keys.updates)) as string).map((u: { id: string }) => u.id))
      .toEqual(['update-a1', 'update-a0']);
  });

  it('an interrupted switch that was setting data aside finishes the same way', async () => {
    await AsyncStorage.multiSet([
      [OWNER_STORAGE_SANDBOX_METADATA_KEY, JSON.stringify({
        version: 1, activeOwnerId: null, legacyAssignedOwnerId: null, lastOwnerId: 'owner-a', updatedAt: '2026-09-30T08:00:00.000Z',
      })],
      ['projectVisionAI.syncQueue.v1', '[]'],
      [OWNER_STORAGE_SANDBOX_JOURNAL_KEY, JSON.stringify({
        version: 1, id: 'transition-1', sourceOwnerId: null, targetOwnerId: 'owner-b',
        legacyAssignedOwnerId: null, lastOwnerId: 'owner-b', sourceSnapshot: {},
        targetSnapshot: { 'projectPhotoUpdate.projects.v2': '["Tower 2"]' },
        quarantine: { id: 'set-aside-1', suspectedOwnerId: 'owner-a', snapshot: { 'projectVisionAI.syncQueue.v1': '[]' } },
        createdAt: '2026-09-30T08:00:00.000Z',
      })],
    ]);
    const sandbox = createOwnerStorageSandbox({ storage });
    expect(await sandbox.recoverInterruptedTransition()).toBe(true);
    expect(await canonicalKeys()).toEqual(['projectPhotoUpdate.projects.v2']);
    expect(await quarantines()).toEqual([expect.objectContaining({
      id: 'set-aside-1', suspectedOwnerId: 'owner-a', snapshot: { 'projectVisionAI.syncQueue.v1': '[]' },
    })]);
    expect(await sandbox.activeOwnerId()).toBe('owner-b');
  });
});

describe('M4 and A9 #5: report baselines and Talk history belong to one account', () => {
  const scopeKey = daveReportSnapshotScopeKey(['Canopy B']);
  const snapshotFor = (taskName: string, capturedAt: string) => {
    const truth = buildDAVEProjectTruth({
      projectId: 'report:canopy b', projectName: 'Canopy B', updates: [], projectAreas: [], referenceDocuments: [],
      scheduleItems: [{ ...task(`t-${taskName}`), taskName }],
    } as never);
    return buildDAVEReportSnapshot({
      truths: [truth], scopeKey, sourceFingerprint: buildDAVEReportSourceFingerprint([truth]), capturedAt,
    });
  };

  it('another account neither sees nor overwrites this account\'s approved report baseline', async () => {
    const sandbox = createOwnerStorageSandbox({ storage });
    await sandbox.activateOwner('owner-a');
    await saveDAVEReportSnapshot(snapshotFor('Pour slab at grid C (A crew)', '2026-09-29T16:00:00.000Z'));

    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-b');
    expect(await loadDAVEReportSnapshot(scopeKey)).toBeNull();
    await saveDAVEReportSnapshot(snapshotFor('Set steel at level 2 (B crew)', '2026-09-30T09:00:00.000Z'));

    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-a');
    expect((await loadDAVEReportSnapshot(scopeKey))?.tasks.map(item => item.taskName))
      .toEqual(['Pour slab at grid C (A crew)']);
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-b');
    expect((await loadDAVEReportSnapshot(scopeKey))?.tasks.map(item => item.taskName))
      .toEqual(['Set steel at level 2 (B crew)']);
  });

  it('another account does not read this account\'s Talk history for a project of the same name', async () => {
    const sandbox = createOwnerStorageSandbox({ storage });
    const history = daveAskHistoryStorageKey('Canopy B');
    const journal = daveAskHistoryJournalStorageKey('Canopy B');
    await sandbox.activateOwner('owner-a');
    await AsyncStorage.multiSet([[history, '[{"question":"A asked"}]'], [journal, '{"pending":"A"}']]);

    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-b');
    expect(await AsyncStorage.getItem(history)).toBeNull();
    expect(await AsyncStorage.getItem(journal)).toBeNull();

    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-a');
    expect(await AsyncStorage.getItem(history)).toBe('[{"question":"A asked"}]');
    expect(await AsyncStorage.getItem(journal)).toBe('{"pending":"A"}');
  });

  it('a baseline left outside the sandbox by an earlier build goes back to its account only', async () => {
    // Signed out when this build arrives; the baseline was never set aside.
    const sandbox = createOwnerStorageSandbox({ storage });
    await sandbox.activateOwner('owner-a');
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', '["Canopy B"]');
    await sandbox.activateOwner(null);
    await saveDAVEReportSnapshot(snapshotFor('Pour slab at grid C (A crew)', '2026-09-29T16:00:00.000Z'));
    const metadata = JSON.parse((await AsyncStorage.getItem(OWNER_STORAGE_SANDBOX_METADATA_KEY)) as string);
    await AsyncStorage.setItem(OWNER_STORAGE_SANDBOX_METADATA_KEY, JSON.stringify({ ...metadata, lastOwnerId: undefined }));

    await sandbox.activateOwner('owner-b');
    expect(await loadDAVEReportSnapshot(scopeKey)).toBeNull();
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-a');
    expect(await loadDAVEReportSnapshot(scopeKey)).toBeNull(); // set aside on B's sign-in, kept
    expect((await quarantines()).some(item => Object.keys(item.snapshot).some(key => key.startsWith('@vitruvius/report-snapshots/'))))
      .toBe(true);
  });

  it('when the same account signs back in, it gets back the baseline an earlier build left outside', async () => {
    const sandbox = createOwnerStorageSandbox({ storage });
    await sandbox.activateOwner('owner-a');
    await AsyncStorage.setItem('projectPhotoUpdate.projects.v2', '["Canopy B"]');
    await sandbox.activateOwner(null);
    await saveDAVEReportSnapshot(snapshotFor('Pour slab at grid C (A crew)', '2026-09-29T16:00:00.000Z'));

    await sandbox.activateOwner('owner-a');
    expect((await loadDAVEReportSnapshot(scopeKey))?.tasks.map(item => item.taskName))
      .toEqual(['Pour slab at grid C (A crew)']);
    expect(await AsyncStorage.getItem('projectPhotoUpdate.projects.v2')).toBe('["Canopy B"]');
  });
});
