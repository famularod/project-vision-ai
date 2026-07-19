#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const sync = read('services/SyncService.ts');
const supabase = read('services/SupabaseService.ts');
const deletionJournal = read('services/ProjectUpdateDeletionJournal.ts');
const migration = read('supabase/migrations/20260706010000_project_update_idempotency_key.sql');

assert(
  /const idempotencyKey = draftSnapshot\.idempotencyKey\s*\|\|\s*\n?\s*draftSnapshot\.stableSendId\s*\|\|\s*`send-\$\{draftSnapshot\.id\}`/.test(app) &&
    app.includes('stableSendId: idempotencyKey') &&
    app.includes('idempotencyKey,'),
  'Initial send must create one stable idempotency key from the draft id.',
);

assert(
  app.includes('stableSendId: update.idempotencyKey || update.stableSendId || `send-${update.id}`') &&
    app.includes('idempotencyKey: update.idempotencyKey || update.stableSendId || `send-${update.id}`'),
  'Retry must reuse the existing update idempotency key instead of regenerating one.',
);

assert(
  sync.includes('function projectUpdateQueueItemId(updateId: string)') &&
    sync.includes('id: projectUpdateQueueItemId(update.id)') &&
    sync.includes('mutateOfflineQueue(queue =>') &&
    sync.includes('existing.id !== queueItem.id &&') &&
    sync.includes('!sameProjectArchiveMutation(existing, queueItem as unknown as SyncQueueItem)') &&
    sync.includes('projectUpdateIdempotencyKey(payload.updateData, payload.id)'),
  'Offline queue must use a stable queue item id and pass a stable idempotency key to the cloud write.',
);

assert(
  sync.includes('const archiveQueueId = projectArchiveQueueItemId(payload)') &&
    sync.includes('id: archiveQueueId ?? undefined') &&
    sync.includes('function sameProjectArchiveMutation('),
  'Project archive queue work must use a stable identity and collapse legacy duplicates.',
);

assert(
  sync.includes('queueProjectUpdateDelete') &&
    sync.includes("operation: 'delete'") &&
    sync.includes("if (item.operation === 'delete')") &&
    sync.includes("existing.operation === 'delete'") &&
    sync.includes("queueItem.operation !== 'delete'") &&
    sync.includes('deleteProjectUpdate({') &&
    sync.includes('hasProjectUpdateDeletionIntent') &&
    sync.includes('confirmProjectUpdateCloudDeletion') &&
    sync.includes("if (item.operation === 'delete') return true") &&
    supabase.includes('export async function deleteProjectUpdate') &&
    supabase.includes(".eq('owner_id', owner.data)") &&
    supabase.includes(".eq('id', updateId)"),
  'A field-update delete must replace same-id pending work, survive cleanup, and execute as an owner-scoped cloud delete.',
);

assert(
  deletionJournal.includes('projectPhotoUpdate.deletionJournal.v1') &&
    deletionJournal.includes('cloudDeleteConfirmedAt') &&
    deletionJournal.includes('recordProjectUpdateDeletionIntent'),
  'Permanent field-update deletion must keep a durable local barrier after its queue item finishes.',
);

assert(
  sync.includes('itemOutcomes?: Record<string, SyncItemOutcome>') &&
    sync.includes("itemOutcomes[item.id] = 'uploaded'") &&
    sync.includes("itemOutcomes[item.id] = 'blocked'") &&
    sync.includes("itemOutcomes[item.id] = 'failed'") &&
    sync.includes("itemOutcome === 'uploaded' && !remainingItem && !currentConflict"),
  'Field-update status must be based on its exact queue outcome, not unrelated global queue totals.',
);

assert(
  sync.includes('pendingPhotoAssetIds?: string[]') &&
    sync.includes('photoAttempt.failedPhotoIds') &&
    sync.includes("return PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS") &&
    sync.indexOf('return PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS') <
      sync.indexOf('const remoteMetadata = await getProjectUpdateSyncMetadata(payload.id)') &&
    sync.includes('if (result === PROJECT_UPDATE_BLOCKED_ON_PHOTO_ASSETS)') &&
    sync.includes("databaseUpsertResult = metadataBlocked\n    ? 'skipped'"),
  'Project update metadata must remain durably queued without retry inflation until every referenced photo is cloud-available.',
);

assert(
  supabase.includes('idempotencyKey?: string | null') &&
    supabase.includes('idempotency_key: stableIdempotencyKey') &&
    supabase.includes(".upsert(payload, { onConflict: 'id' })") &&
    supabase.includes('extractProjectUpdateIdempotencyKey(updateData)') &&
    supabase.includes('sanitizeIdempotencyKey(update.idempotencyKey)') &&
    supabase.includes('sanitizeIdempotencyKey(update.stableSendId)'),
  'Supabase project update upsert must persist the stable idempotency key while keeping id-based upsert behavior.',
);

assert(
  migration.includes('add column if not exists idempotency_key text') &&
    migration.includes('create unique index if not exists project_updates_idempotency_key_unique') &&
    migration.includes('where idempotency_key is not null') &&
    migration.includes("update_data ->> 'idempotencyKey'") &&
    migration.includes("update_data ->> 'stableSendId'"),
  'Migration must add and backfill a database-level unique idempotency key constraint.',
);

assert(
  !sync.includes('service_role') &&
    !supabase.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !sync.includes('functions.invoke') &&
    !supabase.includes("functions.invoke('"),
  'Offline queued send idempotency must not introduce service-role or Edge Function dependencies.',
);

async function testConcurrentEnqueuePreservesBothItems() {
  const data = new Map();
  const storage = {
    async getItem(key) {
      const captured = data.has(key) ? data.get(key) : null;
      await new Promise(resolve => setTimeout(resolve, 10));
      return captured;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
    async getAllKeys() {
      return Array.from(data.keys());
    },
  };
  const cache = new Map();
  const supabaseCalls = { metadataReads: 0, updateWrites: 0, updateDeletes: 0 };
  let signedUrlResult = {
    ok: false,
    configured: true,
    data: null,
    error: 'Object not found',
    status: 400,
    code: 'not_found',
  };
  let ownerResult = { ok: true, configured: true, data: true };
  let photoUploadResult = { ok: true, configured: true, stubbed: false, data: {} };
  let localFileInfo = { exists: false, isDirectory: false };
  let remoteMetadataData = null;
  let projectUpdateDeleteResult = { ok: true, configured: true, stubbed: false };
  let enqueueNewerSameIdOnSave = false;
  let service;
  const supabaseMock = {
    getSupabaseConfigurationStatus() {
      return { configured: true, message: 'Configured.' };
    },
    async getProjectUpdateSyncMetadata() {
      supabaseCalls.metadataReads += 1;
      return { ok: true, data: remoteMetadataData };
    },
    async saveProjectUpdate() {
      supabaseCalls.updateWrites += 1;
      if (enqueueNewerSameIdOnSave) {
        enqueueNewerSameIdOnSave = false;
        await service.enqueuePendingChange({
          id: 'project-update-newer-d',
          entity: 'project_update',
          operation: 'update',
          payload: {
            id: 'newer-d',
            projectName: 'Project D',
            updateData: { id: 'newer-d', projectName: 'Project D', photos: [], notes: 'Newer revision' },
            pendingPhotoAssetIds: [],
          },
          changedAt: '2099-01-01T00:00:00.000Z',
          autoUpload: false,
        });
      }
      return { ok: true, stubbed: false };
    },
    async deleteProjectUpdate() {
      supabaseCalls.updateDeletes += 1;
      return projectUpdateDeleteResult;
    },
    async createPhotoSignedUrl() {
      return signedUrlResult;
    },
    async verifyDAVEAppOwner() {
      return ownerResult;
    },
    async uploadPhoto() {
      return photoUploadResult;
    },
  };
  const fileSystemMock = {
    async getInfoAsync() {
      return localFileInfo;
    },
  };

  function load(relativePath) {
    const normalized = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
    const fullPath = path.join(root, normalized);
    if (cache.has(fullPath)) return cache.get(fullPath);
    const source = fs.readFileSync(fullPath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    const sandbox = {
      exports: {},
      require: specifier => {
        if (specifier === '@react-native-async-storage/async-storage') {
          return { __esModule: true, default: storage };
        }
        if (specifier === 'expo-file-system/legacy') return fileSystemMock;
        if (specifier.endsWith('SupabaseService')) return supabaseMock;
        if (specifier.endsWith('/types') || specifier === '../types') return {};
        if (specifier.startsWith('.')) {
          return load(path.join(path.dirname(normalized), specifier));
        }
        return require(specifier);
      },
      console,
      Date,
      JSON,
      Math,
      Object,
      Array,
      Map,
      Set,
      Promise,
      String,
      Number,
      Boolean,
      Error,
      RegExp,
      setTimeout,
      clearTimeout,
    };
    vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
    cache.set(fullPath, sandbox.exports);
    return sandbox.exports;
  }

  service = load('services/SyncService.ts');
  assert.strictEqual(
    service.cloudPhotoLookupConfirmedMissing(
      { status: 400, error: 'Not found', code: 'bucket_not_found' },
      true,
    ),
    false,
    'a missing or inaccessible bucket must never be mistaken for a missing photo object',
  );
  const photoUpdateForLookup = {
    id: 'photo-lookup-update',
    projectName: 'Hospital',
    selectedAreaName: 'Level 2',
    photos: [],
  };
  const missingLocalPhoto = {
    id: 'photo-lookup',
    uri: 'file:///missing-photo.heic',
    fileName: 'missing-photo.heic',
    mimeType: 'image/heic',
  };

  localFileInfo = { exists: false, isDirectory: false };
  signedUrlResult = {
    ok: false,
    configured: true,
    data: null,
    error: 'Network request failed',
    status: 503,
    code: 'network_error',
  };
  ownerResult = {
    ok: false,
    configured: true,
    data: null,
    error: 'Network request failed',
    status: 503,
  };
  const transientLookup = await service.uploadLocalPhotoWithDiagnostics(
    photoUpdateForLookup,
    missingLocalPhoto,
  );
  assert.strictEqual(transientLookup.result, 'failed', 'transient cloud lookup failures must remain retryable');
  assert.strictEqual(transientLookup.diagnostic.failureCategory, 'network');

  signedUrlResult = {
    ok: false,
    configured: true,
    data: null,
    error: 'Object not found',
    status: 400,
    code: 'not_found',
  };
  ownerResult = { ok: true, configured: true, data: true };
  const confirmedMissing = await service.uploadLocalPhotoWithDiagnostics(
    photoUpdateForLookup,
    missingLocalPhoto,
  );
  assert.strictEqual(confirmedMissing.result, 'missing', 'owner-verified object-not-found may be quarantined');

  ownerResult = { ok: true, configured: true, data: false };
  const nonOwnerLookup = await service.uploadLocalPhotoWithDiagnostics(
    photoUpdateForLookup,
    missingLocalPhoto,
  );
  assert.strictEqual(nonOwnerLookup.result, 'failed', 'non-owner object-not-found must not discard photo evidence');
  assert.strictEqual(nonOwnerLookup.diagnostic.failureCategory, 'rls_denied');

  ownerResult = { ok: true, configured: true, data: true };
  localFileInfo = { exists: true, isDirectory: false, size: 2048 };
  photoUploadResult = { ok: true, configured: true, stubbed: false, data: {} };
  const restoredLocalPhoto = await service.uploadLocalPhotoWithDiagnostics(
    photoUpdateForLookup,
    { ...missingLocalPhoto, cloudRecoveryStatus: 'unavailable' },
  );
  assert.strictEqual(restoredLocalPhoto.result, 'uploaded', 'a restored local file must override its old unavailable marker');

  localFileInfo = { exists: false, isDirectory: false };
  assert.strictEqual(
    service.recoveredSignedPhotoUriIsFresh({ cloudRecoveryStatus: 'signed_url', cloudSignedUrlExpiresAt: null }),
    false,
    'legacy signed photo URLs without an expiry must be renewed',
  );
  assert.strictEqual(
    service.recoveredSignedPhotoUriIsFresh(
      { cloudRecoveryStatus: 'signed_url', cloudSignedUrlExpiresAt: '2026-07-16T12:00:00.000Z' },
      new Date('2026-07-16T12:00:01.000Z').getTime(),
    ),
    false,
    'expired signed photo URLs must be renewed',
  );
  assert.strictEqual(
    service.recoveredSignedPhotoUriIsFresh(
      { cloudRecoveryStatus: 'signed_url', cloudSignedUrlExpiresAt: '2026-07-16T12:10:00.000Z' },
      new Date('2026-07-16T12:00:01.000Z').getTime(),
    ),
    true,
    'unexpired signed photo URLs may be reused',
  );
  await Promise.all([
    service.enqueuePendingChange({
      id: 'queue-a',
      entity: 'project',
      operation: 'create',
      payload: { name: 'A' },
      changedAt: '2026-07-16T12:00:00.000Z',
      autoUpload: false,
    }),
    service.enqueuePendingChange({
      id: 'queue-b',
      entity: 'project',
      operation: 'create',
      payload: { name: 'B' },
      changedAt: '2026-07-16T12:00:01.000Z',
      autoUpload: false,
    }),
  ]);

  const raw = data.get('projectVisionAI.syncQueue.v1');
  const ids = JSON.parse(raw).map(item => item.id).sort();
  assert.strictEqual(
    ids.join(','),
    'queue-a,queue-b',
    'simultaneous queue writes must not lose either pending item',
  );

  data.delete('projectVisionAI.syncQueue.v1');
  await Promise.all([
    service.enqueuePendingChange({
      id: 'stable-update',
      entity: 'project',
      operation: 'update',
      payload: { name: 'Older' },
      changedAt: '2026-07-16T12:01:00.000Z',
      autoUpload: false,
    }),
    service.enqueuePendingChange({
      id: 'stable-update',
      entity: 'project',
      operation: 'update',
      payload: { name: 'Newest' },
      changedAt: '2026-07-16T12:01:01.000Z',
      autoUpload: false,
    }),
  ]);
  const stableQueue = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(stableQueue.length, 1, 'one stable ID must remain one queue item');
  assert.strictEqual(
    stableQueue[0].payload.name,
    'Newest',
    'the newest same-ID queue payload must win',
  );

  data.set('projectVisionAI.syncQueue.v1', JSON.stringify([
    {
      id: 'legacy-shell-archive-a',
      entity: 'project',
      operation: 'update',
      payload: { previousName: 'Fire Pump House', archived: true },
      createdAt: '2026-07-19T08:00:00.000Z',
      changedAt: '2026-07-19T08:00:00.000Z',
      retryCount: 0,
      lastError: null,
    },
    {
      id: 'legacy-shell-archive-b',
      entity: 'project',
      operation: 'update',
      payload: { previousName: ' fire pump house ', archived: true },
      createdAt: '2026-07-19T08:00:01.000Z',
      changedAt: '2026-07-19T08:00:01.000Z',
      retryCount: 0,
      lastError: null,
    },
  ]));
  await service.enqueuePendingChange({
    id: 'project-archive-fire%20pump%20house',
    entity: 'project',
    operation: 'update',
    payload: { previousName: 'FIRE PUMP HOUSE', archived: true },
    changedAt: '2026-07-19T08:00:02.000Z',
    autoUpload: false,
  });
  const collapsedProjectArchiveQueue = JSON.parse(
    data.get('projectVisionAI.syncQueue.v1'),
  );
  assert.strictEqual(
    collapsedProjectArchiveQueue.length,
    1,
    'equivalent legacy project archives must collapse to one current queue item',
  );
  assert.strictEqual(
    collapsedProjectArchiveQueue[0].id,
    'project-archive-fire%20pump%20house',
    'project archives must use a stable normalized queue identity',
  );

  data.delete('projectVisionAI.syncQueue.v1');
  const photoUpdate = {
    id: 'update-with-photo',
    projectName: 'Hospital',
    selectedAreaName: 'Level 2',
    photos: [{ id: 'photo-pending' }],
  };
  await service.queueProjectUpdateRecord(photoUpdate, false);
  const stagedQueue = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.deepStrictEqual(
    Array.from(stagedQueue[0].payload.pendingPhotoAssetIds),
    ['photo-pending'],
    'initial durable staging must block metadata on every referenced photo',
  );

  const blocked = await service.uploadPendingChanges();
  const blockedQueue = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(blocked.queued, 1, 'photo-blocked metadata must remain queued');
  assert.strictEqual(blocked.errors.length, 0, 'photo gating is a wait state, not a generic sync error');
  assert.strictEqual(blockedQueue[0].retryCount, 0, 'photo gating must not inflate retries');
  assert.strictEqual(blockedQueue[0].lastError, null, 'photo gating must not invent an error');
  assert.strictEqual(supabaseCalls.metadataReads, 0, 'blocked metadata must not read the remote row');
  assert.strictEqual(supabaseCalls.updateWrites, 0, 'blocked metadata must not reach the cloud write');

  await service.enqueuePendingChange({
    id: blockedQueue[0].id,
    entity: blockedQueue[0].entity,
    operation: blockedQueue[0].operation,
    payload: { ...blockedQueue[0].payload, pendingPhotoAssetIds: [] },
    changedAt: '2026-07-16T12:02:00.000Z',
    autoUpload: false,
  });
  const uploaded = await service.uploadPendingChanges();
  assert.strictEqual(uploaded.queued, 0, 'metadata may upload after its photo gate clears');
  assert.strictEqual(supabaseCalls.metadataReads, 1, 'unblocked metadata may check the remote row');
  assert.strictEqual(supabaseCalls.updateWrites, 1, 'unblocked metadata may reach the cloud write');

  data.delete('projectVisionAI.syncQueue.v1');
  await service.queueProjectUpdateRecord(
    { id: 'blocked-b', projectName: 'Project B', photos: [{ id: 'photo-b' }] },
    false,
  );
  const scopedA = await service.runFieldUpdateCloudSync({
    id: 'uploaded-a',
    projectName: 'Project A',
    photos: [],
  });
  assert.strictEqual(scopedA.syncResult.queued, 0, 'A must not inherit B\'s blocked queue count');
  assert.strictEqual(scopedA.syncResult.errors.length, 0, 'A must not inherit B\'s sync errors');
  assert.strictEqual(scopedA.workAttempt.databaseUpsertResult, 'success', 'A must be acknowledged from its own item outcome');
  const queueAfterScopedA = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(queueAfterScopedA.length, 1, 'the independently blocked B update must remain queued');
  assert.strictEqual(queueAfterScopedA[0].payload.id, 'blocked-b');

  await service.removeProjectUpdateFromSyncQueue('blocked-b');

  data.delete('projectVisionAI.syncQueue.v1');
  const updateWritesBeforeDelete = supabaseCalls.updateWrites;
  const updateToDelete = {
    id: 'delete-update',
    projectName: 'Project Delete',
    selectedAreaName: 'Canopy A',
    photos: [{
      id: 'delete-photo',
      uri: 'file:///delete-photo.jpg',
      fileName: 'delete-photo.jpg',
      mimeType: 'image/jpeg',
    }],
  };
  await service.queueProjectUpdateRecord(updateToDelete, false);
  projectUpdateDeleteResult = {
    ok: false,
    configured: true,
    stubbed: false,
    error: 'Network request failed',
  };
  await service.queueProjectUpdateDelete(updateToDelete);
  await new Promise(resolve => setTimeout(resolve, 50));
  const queuedDelete = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(queuedDelete.length, 1, 'delete must replace the same-id pending upsert');
  assert.strictEqual(queuedDelete[0].operation, 'delete', 'the replacement queue operation must remain a delete');
  assert.strictEqual(supabaseCalls.updateWrites, updateWritesBeforeDelete, 'delete must never fall through to project-update upsert');
  assert(supabaseCalls.updateDeletes > 0, 'delete queue work must call the cloud delete operation');

  await service.queueProjectUpdateRecord(
    { ...updateToDelete, notes: 'Late in-flight update completion' },
    false,
  );
  const deleteAfterLateUpdate = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(deleteAfterLateUpdate[0].operation, 'delete', 'a late in-flight update must not replace a queued delete');

  await service.removeProjectUpdateFromSyncQueue('delete-update');
  const deleteAfterStartupCleanup = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  assert.strictEqual(deleteAfterStartupCleanup[0].operation, 'delete', 'startup tombstone cleanup must preserve a pending delete');

  projectUpdateDeleteResult = { ok: true, configured: true, stubbed: false };
  const completedDelete = await service.uploadPendingChanges();
  assert.strictEqual(completedDelete.queued, 0, 'successful cloud deletion must clear its queue item');
  assert.strictEqual(JSON.parse(data.get('projectVisionAI.syncQueue.v1')).length, 0);

  const writesAfterCompletedDelete = supabaseCalls.updateWrites;
  await service.queueProjectUpdateRecord(
    { ...updateToDelete, notes: 'Photo work completed after cloud deletion' },
    false,
  );
  assert.strictEqual(
    JSON.parse(data.get('projectVisionAI.syncQueue.v1')).length,
    0,
    'a durable delete barrier must reject a late update after the delete queue item is gone',
  );
  await service.enqueuePendingChange({
    id: 'project-update-delete-update',
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: 'delete-update',
      projectName: 'Project Delete',
      updateData: { ...updateToDelete, notes: 'Already captured in an upload snapshot' },
      pendingPhotoAssetIds: [],
    },
    changedAt: '2099-01-01T00:00:00.000Z',
    autoUpload: false,
  });
  await service.uploadPendingChanges();
  assert.strictEqual(
    supabaseCalls.updateWrites,
    writesAfterCompletedDelete,
    'an already-captured late upload must not recreate a permanently deleted cloud row',
  );
  assert.strictEqual(JSON.parse(data.get('projectVisionAI.syncQueue.v1')).length, 0);

  remoteMetadataData = {
    updatedAt: '2099-01-01T00:00:00.000Z',
    updateData: { id: 'conflict-c', projectName: 'Different cloud data', photos: [] },
  };
  const scopedConflict = await service.runFieldUpdateCloudSync({
    id: 'conflict-c',
    projectName: 'Project C',
    photos: [],
  });
  assert.strictEqual(scopedConflict.syncResult.conflicts, 1, 'the current update must surface its own conflict');
  assert.strictEqual(scopedConflict.syncResult.queued, 0, 'a conflict is not a queued upload');
  assert.strictEqual(scopedConflict.workAttempt.databaseUpsertResult, 'failed');
  remoteMetadataData = null;

  data.delete('projectVisionAI.syncQueue.v1');
  enqueueNewerSameIdOnSave = true;
  const newerSameId = await service.runFieldUpdateCloudSync({
    id: 'newer-d',
    projectName: 'Project D',
    photos: [],
  });
  assert.strictEqual(newerSameId.syncResult.queued, 0, 'one bounded follow-up must flush a newer same-ID revision');
  assert.strictEqual(newerSameId.workAttempt.databaseUpsertResult, 'success');

  data.delete('projectVisionAI.syncQueue.v1');
  await service.queueProjectUpdateRecord(
    { ...photoUpdate, id: 'update-a', photos: [{ id: 'shared-photo-id' }] },
    false,
  );
  await service.queueProjectUpdateRecord(
    { ...photoUpdate, id: 'update-b', photos: [{ id: 'shared-photo-id' }] },
    false,
  );
  await service.removeMissingPhotosFromSyncQueue([
    { updateId: 'update-a', photoId: 'shared-photo-id' },
  ]);
  const scopedQueue = JSON.parse(data.get('projectVisionAI.syncQueue.v1'));
  const updateA = scopedQueue.find(item => item.payload.id === 'update-a');
  const updateB = scopedQueue.find(item => item.payload.id === 'update-b');
  assert.strictEqual(updateA.payload.updateData.photos.length, 1, 'confirmed cleanup must preserve historical photo metadata');
  assert.strictEqual(
    updateA.payload.updateData.photos[0].cloudRecoveryStatus,
    'unavailable',
    'confirmed cleanup must mark only the unrecoverable file unavailable',
  );
  assert.strictEqual(updateA.payload.pendingPhotoAssetIds.length, 0, 'confirmed removal must clear its owning gate');
  assert.strictEqual(updateB.payload.updateData.photos.length, 1, 'same-ID evidence in another update must remain intact');
  assert.strictEqual(updateB.payload.pendingPhotoAssetIds.length, 1, 'another update must keep its independent photo gate');

  const markedUnavailable = service.markMissingPhotosUnavailable(
    { ...photoUpdate, id: 'update-a', photos: [{ id: 'shared-photo-id', caption: 'Keep this history' }] },
    [{ updateId: 'update-a', photoId: 'shared-photo-id' }],
  );
  assert.strictEqual(markedUnavailable.photos.length, 1, 'repair must never delete historical photo metadata');
  assert.strictEqual(markedUnavailable.photos[0].caption, 'Keep this history');
  assert.strictEqual(markedUnavailable.photos[0].cloudRecoveryStatus, 'unavailable');

  const updateWritesBeforeLegacyGate = supabaseCalls.updateWrites;
  data.delete('projectVisionAI.syncQueue.v1');
  await service.enqueuePendingChange({
    id: 'project-update-legacy',
    entity: 'project_update',
    operation: 'update',
    payload: {
      id: 'legacy',
      projectName: 'Hospital',
      updateData: { id: 'legacy', projectName: 'Hospital', photos: [{ id: 'legacy-photo' }] },
    },
    changedAt: '2026-07-16T12:03:00.000Z',
    autoUpload: false,
  });
  const legacyBlocked = await service.uploadPendingChanges();
  assert.strictEqual(legacyBlocked.queued, 1, 'legacy photo-bearing queue items must fail closed');
  assert.strictEqual(
    supabaseCalls.updateWrites,
    updateWritesBeforeLegacyGate,
    'legacy photo-bearing metadata must not bypass the gate',
  );
  await service.cleanupStoredSyncStatusMessages();
  const normalizedLegacy = JSON.parse(data.get('projectVisionAI.syncQueue.v1'))[0];
  assert.deepStrictEqual(
    Array.from(normalizedLegacy.payload.pendingPhotoAssetIds),
    ['legacy-photo'],
    'startup cleanup must normalize legacy photo references into the safe gate',
  );
  assert.strictEqual(normalizedLegacy.payload.updateData.photos.length, 1, 'startup cleanup must never drop evidence to bypass the gate');
}

testConcurrentEnqueuePreservesBothItems()
  .then(() => console.log('Offline queue idempotency and concurrency tests passed.'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
