jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { daveProjectUpdateMatchesCloudReceipt } from '../../services/DAVEProjectUpdateCloudReceipt';
import { mergeLocalUpdateWithCloudCopy } from '../../services/DAVECloudRecovery';
import { fieldUpdateSyncGeneration, sameFieldUpdateSyncGeneration } from '../../services/FieldUpdateSyncGeneration';
import { hasMatchingQueuedProjectUpdateRevision } from '../../services/ProjectUpdateQueueRevision';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import { classifySyncFailureText } from '../../services/SyncFailureCategory';
import { prepareQueuedFieldUpdateSave } from '../../services/FieldUpdateLocalPersistence';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');

const base = {
  id: 'u1', projectName: 'P', date: '2026-09-30', notes: 'Rebar placed', recipients: { contactIds: [] },
};
/** The phone's own record: a local file, no storage path yet. */
const local = { ...base, status: 'queued', photos: [{ id: 'p1', uri: 'file:///photos/p1.jpg', caption: 'Rebar', cloudStoragePath: null }] };
/** The same update as the cloud row: the storage path stamped at staging, no local file. */
const row = { ...base, status: 'queued', photos: [{ id: 'p1', uri: '', caption: 'Rebar', cloudStoragePath: 'P/u1/p1-p1.jpg' }] };
/** The queued copy staging writes: the local record plus the storage path. */
const queued = { ...local, photos: [{ ...local.photos[0], cloudStoragePath: 'P/u1/p1-p1.jpg' }] };

// Whole-app audit, area A4 batch 3 / A7 (30 Sep 2026): the storage path is
// stamped only on the queued and cloud copies, so the phone's own record
// never matched its own upload echo and read "Waiting to Sync".
describe('the storage path is transport: the phone’s own record matches its upload', () => {
  it('is its cloud receipt, and takes it as sent', () => {
    expect(daveProjectUpdateMatchesCloudReceipt(local, row)).toBe(true);
    expect(mergeLocalUpdateWithCloudCopy(local as never, row as never)).toMatchObject({ status: 'sent', notes: 'Rebar placed' });
    // A real difference is still a difference.
    expect(daveProjectUpdateMatchesCloudReceipt({ ...local, notes: 'Rebar placed; inspector due' }, row)).toBe(false);
  });

  it('is the same generation, so the queue guard recognises the stamped queued copy', () => {
    // Batch 4: the path counts only when both copies carry one.
    expect(sameFieldUpdateSyncGeneration(local, queued)).toBe(true);
    expect(fieldUpdateSyncGeneration(local)).not.toBe(fieldUpdateSyncGeneration(queued));
    const queue = [{ id: 'project-update-u1', entity: 'project_update', operation: 'update', payload: { id: 'u1', updateData: queued }, createdAt: 't', changedAt: 't', retryCount: 0 }];
    expect(hasMatchingQueuedProjectUpdateRevision(local as never, queue as never)).toBe(true);
    expect(hasMatchingQueuedProjectUpdateRevision({ ...local, notes: 'edited' } as never, queue as never)).toBe(false);
    // A photo change is still a new generation.
    expect(fieldUpdateSyncGeneration({ ...local, photos: [] })).not.toBe(fieldUpdateSyncGeneration(local));
  });
});

describe('a realtime row is a cloud copy, not a replacement', () => {
  /** The app's merge rule: a local record takes a matching cloud copy's receipt; a cloud-only row is synced. */
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
  const applierFor = (updates: Array<Record<string, unknown>>) => {
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
      updateHasPendingLocalWork: (update: Record<string, unknown>) => update.status !== 'sent',
      mergeUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: (updateId: string, deletedAt: string) => ({ updateId, deletedAt, action: 'hide_cloud_update' }),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates, commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    } as never);
    return { apply, commitUpdates };
  };
  const echo = (update: Record<string, unknown>) => ({
    eventType: 'INSERT' as const,
    newRow: { id: update.id, project_id: null, project_name: update.projectName, area_name: null, updated_at: '2026-09-30T10:00:00.000Z', update_data: update },
  });
  const photoless = { ...base, status: 'queued', photos: [] };

  it('turns the phone’s own just-uploaded update to synced, keeps newer local content, and adds a teammate’s row as synced', async () => {
    const own = applierFor([photoless]);
    expect(await own.apply('project_update', echo(photoless) as never)).toBe(true);
    expect(own.commitUpdates).toHaveBeenCalledTimes(1);
    expect(own.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', status: 'sent', notes: 'Rebar placed' })]);

    const edited = applierFor([{ ...photoless, notes: 'Rebar placed; inspector due', status: 'failed' }]);
    await edited.apply('project_update', echo(photoless) as never);
    expect(edited.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', status: 'failed', notes: 'Rebar placed; inspector due' })]);

    const teammate = applierFor([]);
    await teammate.apply('project_update', echo(photoless) as never);
    expect(teammate.commitUpdates.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'u1', status: 'sent' })]);
  });

  it('is wired that way, and a cloud-sourced row is synced in the app’s merge', () => {
    const applier = read('services/DAVEOperationalRealtimeApplication.ts');
    // Batch 4: a local record with no pending work takes the newer row; one still owed its sync keeps its content.
    // Round 2 (A4 pass 6 F3): the row is cloudCopy, previewReady with photo paths from the fresh read.
    // Whole-app audit A7 pass 6 M1: a copy waiting only for document changes
    // (patches on the cloud's copy) is not kept either, and the receipt is
    // the row with this device's upload state but without those changes.
    expect(applier).toMatch(/options\.commitUpdates\(options\.mergeUpdates\(\{\n\s+localUpdates: fresh\.updates\.map\(update =>\n\s+update\.id === previewReady\.id && \(onlyDocumentChangesWait \|\| !options\.updateHasPendingLocalWork\(update\)\) \? cloudCopy : update\),\n\s+cloudUpdates: \[receipt\],\n\s+tombstones: deletedUpdates,\n\s+\}\)\);/);
    expect(applier).toContain('const receipt = withDeviceDocumentUploadState(deviceCopy, options.deviceDocuments?.());');
    expect(app).toContain('updateHasPendingLocalWork: updateNeedsAutomaticSyncRetry,');
    expect(applier).toContain('const fresh = options.snapshot();');
    expect(app).toContain(": { ...update, status: 'sent' as const };");
    expect(read('services/DAVEProjectUpdateCloudReceipt.ts')).toContain('alignPhotoStoragePaths(left, right)');
  });
});

describe('the retry loop after a save, on reconnect and on return to the foreground', () => {
  it('leaves an update to its own sync for a grace period, then follows once; runs on reconnect and when the app becomes active', () => {
    expect(app).toContain('const DIRECT_SYNC_GRACE_MS = 20_000;');
    expect(app).toContain('const queuedUpdates = retryable.filter(update => !directSyncIsRecent(update, now));');
    // Batch 4: a pass still running is asked for one more instead of a new task.
    expect(app).toMatch(/queuedHydrationDeferredRerun\.current = setTimeout\(\(\) => \{\n\s+queuedHydrationDeferredRerun\.current = null;\n(?:\s*\/\/.*\n)*\s+if \(queuedHydrationInFlight\.current\) queuedHydrationRerunRequested\.current = true;\n\s+else startAutomaticSyncBackgroundTask\('after_direct_sync', hydrateQueuedUpdates\);\n\s+\}, DIRECT_SYNC_GRACE_MS\);/);
    expect(app).toContain("startAutomaticSyncBackgroundTask('realtime_reconnected', hydrateQueuedUpdates);");
    expect(app).toContain("startAutomaticSyncBackgroundTask('app_active', hydrateQueuedUpdates);");
  });
});

describe('the classifier puts access failures first and only unambiguous transport text means offline', () => {
  it('orders the checks', () => {
    expect(classifySyncFailureText(['new row violates row-level security policy; TypeError: Network request failed'])).toBe('rls_denied');
    expect(classifySyncFailureText(['JWT expired while the network was slow'])).toBe('auth');
    expect(classifySyncFailureText(['canceling statement due to statement timeout'])).toBe('unknown');
    expect(classifySyncFailureText(['Project update database upsert failed: TypeError: Network request failed'])).toBe('offline');
    expect(classifySyncFailureText(['The Internet connection appears to be offline.'])).toBe('offline');
  });
});

describe('the barred save says which barrier, and the draft write is put back', () => {
  it('reports the barrier action', () => {
    const keys = { journal: 'j', updates: 'u', tombstones: 't', draft: 'd' };
    const merge = ({ localUpdates, tombstones }: { localUpdates: Array<{ id: string }>; cloudUpdates: unknown[]; tombstones: Array<{ updateId: string }> }) => {
      const barred = new Set(tombstones.map(item => item.updateId));
      return localUpdates.filter(update => !barred.has(update.id));
    };
    const archived = prepareQueuedFieldUpdateSave({
      snapshot: { persistedUpdates: [], persistedTombstones: [], persistedDraft: null } as never,
      queuedUpdate: { id: 'u1' } as never, currentUpdates: [],
      currentTombstones: [{ updateId: 'u1', action: 'hide_cloud_update' }] as never, keys, mergeVisibleUpdates: merge as never,
    });
    expect(archived.result).toMatchObject({ applied: false, barrierAction: 'hide_cloud_update' });
    const clean = prepareQueuedFieldUpdateSave({
      snapshot: { persistedUpdates: [], persistedTombstones: [], persistedDraft: null } as never,
      queuedUpdate: { id: 'u1' } as never, currentUpdates: [], currentTombstones: [], keys, mergeVisibleUpdates: merge as never,
    });
    expect(clean.result).toMatchObject({ applied: true, barrierAction: null });
  });

  it('is wired: wording by barrier, the draft write re-armed, every discard ordered', () => {
    expect(app).toContain("const archived = barrierAction === 'hide_cloud_update' || barrierAction === 'archive_sent_update';");
    expect(app.match(/void persistDraftNow\(draftRef\.current\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).toContain("onPress: () => clearOpenDraft(projectName, draftRef.current) },");
    expect(app).toContain("clearOpenDraft(activeProjects[0] || '', draftRef.current);");
    expect(app).toMatch(/if \(hasDraftContent\(discardedDraft\)\) void discardDraftAfterReplacement\(discardedDraft\);\n\s+else void persistDraftNow\(nextDraft\);/);
    expect(app).not.toContain('void deleteUnreferencedPhotosFromUpdate(\n              discardedDraft,\n              savedUpdates,\n            );');
  });
});
