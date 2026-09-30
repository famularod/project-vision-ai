jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { alignPhotoStoragePaths } from '../../services/PhotoStoragePathAlignment';
import { daveProjectUpdateMatchesCloudReceipt } from '../../services/DAVEProjectUpdateCloudReceipt';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { reconcileFieldUpdateSyncResult, sameFieldUpdateSyncGeneration } from '../../services/FieldUpdateSyncGeneration';
import { hasMatchingQueuedProjectUpdateRevision } from '../../services/ProjectUpdateQueueRevision';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');

const base = {
  id: 'u1', projectName: 'P', date: '2026-09-30', notes: 'Rebar placed', recipients: { contactIds: [] },
};
const photo = (cloudStoragePath: string | null, uri = 'file:///photos/p1.jpg') => ({ id: 'p1', uri, caption: 'Rebar', cloudStoragePath });

// Whole-app audit, area A4 pass 3 (30 Sep 2026): batch 3 ignored the storage
// path everywhere, so a legacy path relocated on the phone matched the old
// cloud row as its own receipt and the relocation never reached the cloud.
// The path is ignored only where one side lacks it.
describe('a photo’s storage path is compared when both copies carry one', () => {
  it('drops the path key from both copies only where one side has none, photo by photo', () => {
    const [left, right] = alignPhotoStoragePaths(
      { photos: [photo('P/u1/p1.jpg'), { id: 'p2', uri: 'file:///p2.jpg', cloudStoragePath: 'P/u1/p2.jpg' }, { id: 'p3', uri: 'file:///p3.jpg' }] },
      { photos: [photo(null, ''), { id: 'p2', uri: '', cloudStoragePath: 'P/u1/p2-relocated.jpg' }] },
    );
    expect(left.photos[0]).toEqual({ id: 'p1', uri: 'file:///photos/p1.jpg', caption: 'Rebar' });
    expect(left.photos[1]).toEqual({ id: 'p2', uri: 'file:///p2.jpg', cloudStoragePath: 'P/u1/p2.jpg' });
    expect(left.photos[2]).toEqual({ id: 'p3', uri: 'file:///p3.jpg' });
    expect(right.photos[0]).toEqual({ id: 'p1', uri: '', caption: 'Rebar' });
    expect(right.photos[1]).toEqual({ id: 'p2', uri: '', cloudStoragePath: 'P/u1/p2-relocated.jpg' });
    // Null (a stored record) and absent (a fresh photo) read alike: the key goes from both (pass 4).
    const [storedSide, freshSide] = alignPhotoStoragePaths({ photos: [{ id: 'p1', uri: 'a', cloudStoragePath: null }] }, { photos: [{ id: 'p1', uri: 'a' }] });
    expect(storedSide.photos[0]).toEqual({ id: 'p1', uri: 'a' });
    expect(freshSide.photos[0]).toEqual({ id: 'p1', uri: 'a' });
    // Records without a photo list pass through untouched.
    const plain = { notes: 'x' } as { notes: string; photos?: unknown };
    expect(alignPhotoStoragePaths(plain, plain)).toEqual([plain, plain]);
  });

  it('a relocated path is not the old row’s receipt, and is not a new generation of the queued copy', () => {
    const local = { ...base, status: 'queued', photos: [photo('P/u1/p1-relocated.jpg')] };
    const oldRow = { ...base, status: 'queued', photos: [photo('P/legacy/p1.jpg', '')] };
    const sameRow = { ...base, status: 'queued', photos: [photo('P/u1/p1-relocated.jpg', '')] };
    const unstamped = { ...base, status: 'queued', photos: [photo(null)] };
    expect(daveProjectUpdateMatchesCloudReceipt(local, oldRow)).toBe(false);
    expect(mergeLocalUpdateWithCloudCopy(local as never, oldRow as never)).toMatchObject({ status: 'queued', photos: [expect.objectContaining({ cloudStoragePath: 'P/u1/p1-relocated.jpg' })] });
    expect(daveProjectUpdateMatchesCloudReceipt(local, sameRow)).toBe(true);
    expect(daveProjectUpdateMatchesCloudReceipt(unstamped, oldRow)).toBe(true);

    // The generation guard compares the phone's record with the queued copy and never counts the path
    // (pass 4: only staging writes the queued copy's path, a relocation found at upload included, so a
    // path difference is never a user edit; the receipt above still compares paths when both carry one).
    const queuedOld = { ...base, status: 'queued', photos: [photo('P/legacy/p1.jpg')] };
    const queuedSame = { ...base, status: 'queued', photos: [photo('P/u1/p1-relocated.jpg')] };
    expect(sameFieldUpdateSyncGeneration(local, queuedOld)).toBe(true);
    expect(sameFieldUpdateSyncGeneration(local, queuedSame)).toBe(true);
    expect(sameFieldUpdateSyncGeneration(unstamped, queuedOld)).toBe(true);
    expect(sameFieldUpdateSyncGeneration({ ...local, notes: 'edited' }, queuedOld)).toBe(false);
    const queue = [{ id: 'project-update-u1', entity: 'project_update', operation: 'update', payload: { id: 'u1', updateData: queuedOld }, createdAt: 't', changedAt: 't', retryCount: 0 }];
    expect(hasMatchingQueuedProjectUpdateRevision(local as never, queue as never)).toBe(true);
    expect(hasMatchingQueuedProjectUpdateRevision(unstamped as never, queue as never)).toBe(true);
    // A sync result lands on the record whatever path either copy carries; an edited record refuses it.
    const result = { ...queuedOld, status: 'sent' };
    expect(reconcileFieldUpdateSyncResult([local], queuedOld, result).applied).toBe(true);
    expect(reconcileFieldUpdateSyncResult([unstamped], queuedOld, result).applied).toBe(true);
    expect(reconcileFieldUpdateSyncResult([{ ...local, notes: 'edited' }], queuedOld, result).applied).toBe(false);
  });
});

describe('a realtime row replaces a local record that owes nothing, and only that', () => {
  const mergeUpdates = ({ localUpdates, cloudUpdates }: { localUpdates: Array<Record<string, unknown>>; cloudUpdates: Array<Record<string, unknown>> }) => {
    const cloudById = new Map(cloudUpdates.map(update => [update.id as string, update]));
    const seen = new Set<string>();
    const merged = localUpdates.map(update => {
      seen.add(update.id as string);
      return mergeLocalUpdateWithCloudCopy(update as never, cloudById.get(update.id as string) as never) as Record<string, unknown>;
    });
    for (const update of cloudUpdates) {
      if (!seen.has(update.id as string)) merged.push({ ...update, status: 'sent' });
    }
    return merged;
  };
  const applierFor = (updates: Array<Record<string, unknown>>, pending: (update: Record<string, unknown>) => boolean) => {
    const commitUpdates = jest.fn();
    const state = {
      projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
      updates, deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [],
    };
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => state,
      getPendingQueue: async () => [],
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown) => value,
      normalizeSchedule: (value: unknown) => value,
      normalizeDocuments: (value: unknown) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames: (baseNames: string[]) => baseNames,
      updateHasPendingLocalWork: pending,
      mergeUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: (updateId: string, deletedAt: string) => ({ updateId, deletedAt, action: 'hide_cloud_update' }),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    } as never);
    return { apply, commitUpdates };
  };
  const row = (update: Record<string, unknown>) => ({
    eventType: 'UPDATE' as const,
    newRow: { id: update.id, project_id: null, project_name: update.projectName, area_name: null, updated_at: '2026-09-30T10:00:00.000Z', update_data: update },
  });
  const held = { ...base, status: 'sent', photos: [] };
  const teammateEdit = { ...held, notes: 'Rebar placed; inspector signed off' };
  const notPending = (update: Record<string, unknown>) => update.status === 'queued' || update.status === 'failed';

  it('takes a teammate’s newer revision of a synced update, as the refresh does', async () => {
    const synced = applierFor([held], notPending);
    expect(await synced.apply('project_update', row(teammateEdit) as never)).toBe(true);
    expect(synced.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', status: 'sent', notes: 'Rebar placed; inspector signed off' })]);
  });

  it('keeps a queued or failed record’s own content', async () => {
    const owed = applierFor([{ ...held, status: 'queued', notes: 'Rebar placed; my edit' }], notPending);
    await owed.apply('project_update', row(teammateEdit) as never);
    expect(owed.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', status: 'queued', notes: 'Rebar placed; my edit' })]);
    // The predicate decides, not the status string: the app passes its retry rule.
    const decided = applierFor([held], () => true);
    await decided.apply('project_update', row(teammateEdit) as never);
    expect(decided.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', notes: 'Rebar placed' })]);
  });
});

describe('the three small fixes from pass 3', () => {
  it('a send stamp in the future is not a running sync; a running pass is asked for one more; a refused save re-persists the saved list', () => {
    expect(app).toMatch(/function directSyncIsRecent\(update: ProjectUpdate, now: number\): boolean \{\n\s+const attemptedAt = Date\.parse\(update\.lastSendAttemptAt \?\? ''\);\n\s+if \(!Number\.isFinite\(attemptedAt\)\) return false;\n(?:\s*\/\/.*\n)*\s+const age = now - attemptedAt;\n\s+return age >= 0 && age < DIRECT_SYNC_GRACE_MS;\n\}/);
    expect(app).toMatch(/if \(queuedHydrationInFlight\.current\) queuedHydrationRerunRequested\.current = true;\n\s+else startAutomaticSyncBackgroundTask\('after_direct_sync', hydrateQueuedUpdates\);/);
    // The refused branch re-persists at once; the failed branch only when the store was not declared unreadable (pass 4).
    const rePersisted = app.match(/void persistDraftNow\(draftRef\.current\);\n\s+persistStorageItem\(UPDATES_STORAGE_KEY, JSON\.stringify\(savedUpdatesRef\.current\)\)\.catch\(/g) ?? [];
    expect(rePersisted).toHaveLength(1);
    expect(app).toMatch(/void persistDraftNow\(draftRef\.current\);\n(?:\s*\/\/.*\n)*\s+if \(!\(error instanceof FieldUpdatePersistenceBlockedError\)\) \{\n\s+persistStorageItem\(UPDATES_STORAGE_KEY, JSON\.stringify\(savedUpdatesRef\.current\)\)\.catch\(/);
  });
});
