#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'services/FieldUpdateLifecycle.ts'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'screens/AdminScreen.tsx'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
const projectService = fs.readFileSync(path.join(root, 'services/projectService.ts'), 'utf8');
const storageMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260707000000_project_storage_buckets.sql'),
  'utf8',
);
const authenticatedStorageMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260707010000_project_storage_authenticated_policies.sql'),
  'utf8',
);
const authenticatedProjectSyncMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260707020000_project_sync_authenticated_policies.sql'),
  'utf8',
);
const ownerRestrictedProjectSyncMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260716000000_project_sync_single_user_ownership_rls.sql'),
  'utf8',
);
const membershipSetup = fs.readFileSync(
  path.join(root, 'scripts/create-dev-project-member.js'),
  'utf8',
);
const storageSmoke = fs.readFileSync(
  path.join(root, 'scripts/storage-smoke-test.js'),
  'utf8',
);
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

function includes(source, marker, message) {
  assert(source.includes(marker), message);
}

includes(app, 'FieldUpdateSyncDiagnostics', 'updates must persist safe sync diagnostics');
includes(app, 'lastSyncFailureCategory', 'sync diagnostics must include safe failure category');
includes(app, 'lastSyncAttemptAt', 'sync diagnostics must include latest attempt timestamp');
includes(app, 'cloudUpdateInsertAttempted', 'sync diagnostics must show whether cloud update insert was attempted');
includes(app, 'photoStorageUploadAttempted', 'sync diagnostics must show whether photo upload was attempted');
includes(app, 'storageUploadResult', 'sync diagnostics must show storage upload result');
includes(app, 'databaseUpsertResult', 'sync diagnostics must show database insert/update result');
includes(app, 'rlsOrAuthFailureDetected', 'sync diagnostics must show safe RLS/auth detection');
includes(app, 'retryAvailable', 'sync diagnostics must show retry availability');
includes(app, 'storageBucketName', 'sync diagnostics must include safe bucket name');
includes(app, 'storageBucketExists', 'sync diagnostics must include bucket existence result');
includes(app, 'storageFailureCategory', 'sync diagnostics must include safe storage failure category');
includes(app, 'storageHttpStatus', 'sync diagnostics must include storage HTTP/status code when available');
includes(app, 'storageErrorCode', 'sync diagnostics must include Supabase storage error code when available');
includes(app, 'retryAttemptNumber', 'sync diagnostics must include retry attempt number');
includes(app, 'localFileExists', 'sync diagnostics must include local file existence');
includes(app, 'localFileReadable', 'sync diagnostics must include local file readability');
includes(app, 'fileByteSizeCategory', 'sync diagnostics must include safe byte-size category');
includes(app, 'uploadPayloadType', 'sync diagnostics must include upload payload type');
includes(app, 'storageContentType', 'sync diagnostics must include upload content type');
includes(app, 'objectPathCategory', 'sync diagnostics must include object path category');
includes(app, 'databaseSyncRanAfterUpload', 'sync diagnostics must show whether database sync ran after upload');
includes(app, 'failedOperationName', 'sync diagnostics must include failed operation name');
includes(app, 'failedLogicalTarget', 'sync diagnostics must include failed table/bucket name');
includes(app, 'rlsDenied', 'sync diagnostics must show RLS denial safely');
includes(app, 'authenticatedUserIdPresent', 'sync diagnostics must show whether an authenticated user id exists');
includes(app, 'projectIdPresent', 'sync diagnostics must show whether a project id is available');
includes(app, 'organizationIdPresent', 'sync diagnostics must show whether organization id is available');
includes(app, 'membershipCheckResult', 'sync diagnostics must show membership check result');
includes(app, "'offline'", 'sync diagnostics must include offline category');
includes(app, "'signed_out'", 'sync diagnostics must include signed_out category');
includes(app, "'rls_denied'", 'sync diagnostics must include rls_denied category');
includes(app, "'storage_upload_failed'", 'sync diagnostics must include storage_upload_failed category');
includes(app, "'database_insert_failed'", 'sync diagnostics must include database_insert_failed category');
includes(app, "'malformed_payload'", 'sync diagnostics must include malformed_payload category');
includes(app, "connectionType: 'wifi' | 'cellular' | 'none' | 'unknown'", 'diagnostics must model connection type safely');
includes(app, 'therefore never blocked client-side', 'cellular must not be treated as offline');
assert(!app.includes('NetInfo'), 'app must not pretend to use NetInfo without the dependency');

includes(app, 'buildSyncDiagnosticsFromUpload', 'send/retry must classify upload result');
includes(app, 'statusForSyncDiagnostics', 'sync result must decide cloud-synced/queued/failed state');
includes(lifecycle, "if (input.failureCategory === 'offline') return 'queued';", 'only offline failures should remain queued');
includes(lifecycle, "return 'failed';", 'online sync failures should become failed and retryable');
includes(app, "Sign in required to sync", 'signed-out sync state must be explicit');
includes(app, "Session expired · Sign in again", 'expired/auth send state must ask for sign-in again');
includes(app, "Sync failed · Permission issue", 'RLS failures must use permission copy');
includes(app, "Project access required to sync", 'missing project membership must use project access copy');
includes(app, "Photo unavailable · retake or replace photo", 'stale local photos must not show generic upload copy');
includes(app, "Sync failed · Photo upload issue", 'storage failures must use photo upload copy');
includes(app, "Sync failed · Update save issue", 'database failures must use update save copy');
includes(app, "Sync failed · App data issue", 'malformed payload failures must use app data copy');
includes(app, "Sync failed · Retry", 'online sync failure must show retryable copy');
includes(app, "Queued — will sync when you're back online", 'offline queued copy must be specific');
includes(app, 'onRetry={updateCanInlineRetry(update) ? () => retryUpdate(update) : undefined}', 'queued/failed cards must expose retry');
includes(app, 'void hydrateQueuedUpdates();', 'sync worker must run after save/sign-in or queue wake-up');
includes(app, "AppState.addEventListener('change'", 'sync worker must run on app foreground');
includes(app, 'runFieldUpdateCloudSync', 'send/retry must call the shared structured cloud sync work');
includes(app, 'onRetryUpdateSync={update => retryQueuedUpdate', 'Settings must retry through the live Field Update sync path');
includes(admin, 'onRetryUpdateSync(update)', 'Settings must await the live update retry result');
includes(admin, 'withSyncTimeout', 'Settings sync must not remain indefinitely stuck in its busy state');
includes(admin, 'Review Conflicts', 'Settings must provide a review path for genuine sync conflicts');
includes(admin, 'remainingConflicts > 0', 'Settings must not report success while sync conflicts remain');
includes(admin, "...result.errors.slice(0, 3).map(error => `• ${error}`)", 'full sync failures must identify the affected records instead of showing only an anonymous count');
includes(admin, 'Keep Phone', 'conflict review must allow an explicit phone-copy choice');
includes(admin, 'Keep Cloud', 'conflict review must allow an explicit cloud-copy choice');
const settingsRetryHandler = admin.slice(
  admin.indexOf('async function handleRetrySync'),
  admin.indexOf('async function handleFullSyncNow'),
);
assert(!settingsRetryHandler.includes('synchronizeLocalData('), 'Settings Retry Sync must not re-upload every local record');
includes(admin, 'async function handleFullSyncNow', 'Settings must retain explicit full project-data sync');
includes(admin, 'synchronizeLocalData(', 'Full project-data sync must continue to include schedules, areas, and documents');
const settingsFullSyncHandler = admin.slice(
  admin.indexOf('async function handleFullSyncNow'),
  admin.indexOf('function confirmConflictResolution'),
);
assert(!settingsFullSyncHandler.includes('withSyncTimeout('), 'full sync must not release its busy state while uncancelled work continues in the background');
includes(admin, "? 'Sync in progress'", 'Settings must identify an active full sync instead of simultaneously showing All caught up');
includes(admin, 'lastFullSyncIssueCount > 0', 'Settings must not show All caught up after a full-sync item failure');
assert(!settingsFullSyncHandler.includes('setLastFullSyncIssueCount(1);'), 'full sync exceptions must not invent a one-item retry count');
includes(admin, 'no pending retry items were found', 'full sync exceptions with an empty queue must explain that no item is pending');
includes(sync, 'export async function runFieldUpdateCloudSync', 'shared sync service must own field update orchestration');
includes(sync, 'update.photos.map(photo => uploadLocalPhotoWithDiagnostics(update, photo))', 'shared sync must await photo upload work with diagnostics');
includes(sync, 'await queueProjectUpdateRecord(cloudRecoverableUpdate, false)', 'shared sync must stage cloud-recoverable update metadata in the durable queue');
assert(
  sync.indexOf('await queueProjectUpdateRecord(cloudRecoverableUpdate, false)') <
    sync.indexOf('const photoAttempt = await uploadUpdatePhotosForSync(cloudRecoverableUpdate)'),
  'shared sync must persist update metadata before potentially slow photo work',
);
includes(sync, 'let aggregateResult = await uploadPendingChanges()', 'shared sync must attempt database insert/update work');
includes(sync, "itemOutcomes[item.id] = 'uploaded'", 'shared sync must retain an exact per-item upload outcome');
includes(sync, 'itemOutcome === \'uploaded\' && !remainingItem && !currentConflict', 'field-update success must ignore unrelated queued items while protecting newer same-ID work');
includes(sync, 'reconcileSyncConflicts', 'stored equivalent and duplicate conflicts must be reconciled');
includes(sync, 'if (key === SYNC_CONFLICTS_STORAGE_KEY)', 'sync cleanup must repair the structured conflict store separately');
includes(sync, "if (!Array.isArray(parsed)) return '[]';", 'invalid conflict storage must self-repair without inventing a retry item');
includes(sync, 'return nextValue;', 'valid JSON sync storage must retain its structured envelope');
includes(sync, 'Schedule task “${item.taskName}” could not sync.', 'full sync errors must identify the schedule task that failed');
includes(sync, 'Document “${document.name}” could not sync.', 'full sync errors must identify the document that failed');
includes(sync, 'Project already synced: ${normalizedName}', 'already-synced projects must still advance full-sync progress');
includes(sync, 'const cloudCopy = await createPhotoSignedUrl', 'a missing local photo must be checked in cloud storage before full sync reports failure');
includes(sync, 'is missing from both this phone and cloud storage', 'photo attention copy must distinguish a truly missing photo from an already-uploaded cloud copy');
assert(
  sync.indexOf('const cloudCopy = await createPhotoSignedUrl') <
    sync.indexOf('const fileState = localUri'),
  'historical photos must be checked in cloud storage before any local-file upload work',
);
includes(sync, 'const ownerCheck = await verifyDAVEAppOwner()', 'automatic missing-photo repair must verify the authenticated storage owner');
includes(sync, 'cloudPhotoLookupConfirmedMissing', 'automatic repair must require a confirmed object-not-found response');
includes(sync, 'projectUpdatePayloadsMatch(payload.updateData, remoteMetadata.data.updateData)', 'equivalent remote updates must not create false conflicts');
includes(sync, "id: `project-update-${localPayload.id}`", 'keeping the phone copy must resolve through the durable queue');
includes(sync, "resolution: 'keep_local' | 'keep_cloud'", 'genuine conflicts must require an explicit resolution choice');
includes(sync, 'const staged = await stageProjectUpdateForSync(update)', 'field send and Settings reconciliation must share update staging');
assert(!app.includes('async function runFieldUpdateCloudSync'), 'App must not own a second field-update sync engine');
assert(!app.includes('void stageProjectUpdateForSync(saved)'), 'draft saves must not leave newly staged updates waiting without a background flush');
includes(sync, 'details.updatesUploaded = stagedUpdateUpload.uploadedByEntity?.project_update || 0', 'Settings sync must report uploads from the durable queue');
assert.strictEqual(
  (sync.match(/saveProjectUpdate\(\{/g) || []).length,
  1,
  'project update database writes must have one queue-owned execution path',
);
assert(
  app.indexOf('const tokenResult = await getCurrentSessionAccessToken();') <
    app.indexOf('const { syncResult, workAttempt } = await runFieldUpdateCloudSync(queuedUpdate);'),
  'send must fetch fresh session state before invoking sync work',
);
const retryStart = app.indexOf('async function retryQueuedUpdate');
const retryEnd = app.indexOf('async function hydrateQueuedUpdates', retryStart);
const retrySync = app.slice(retryStart, retryEnd);
assert(
    retrySync.indexOf('const tokenResult = await getCurrentSessionAccessToken();') >= 0 &&
    retrySync.indexOf('const tokenResult = await getCurrentSessionAccessToken();') <
      retrySync.indexOf('syncFieldUpdateWithMissingPhotoRepair('),
  'retry must fetch fresh session state before invoking sync work',
);
includes(
  app,
  'async function syncFieldUpdateWithMissingPhotoRepair(',
  'retry repair must use one bounded missing-photo recovery path',
);
includes(
  app,
  'await runFieldUpdateCloudSync(update)',
  'missing-photo recovery must start with the normal durable sync engine',
);
assert(
  app.indexOf('await persistSavedUpdateImmediately(repairedUpdate)') <
    app.indexOf('const repairedAttempt = await runFieldUpdateCloudSync(repairedUpdate)'),
  'automatic repair must persist the unavailable marker before its second cloud attempt',
);
includes(app, 'cloud insert attempted', 'dev diagnostics must expose cloud insert attempt safely');
includes(app, 'photo upload attempted', 'dev diagnostics must expose photo upload attempt safely');
includes(app, 'storage bucket', 'dev diagnostics must expose bucket name safely');
includes(app, 'bucket exists', 'dev diagnostics must expose bucket existence safely');
includes(app, 'storage category', 'dev diagnostics must expose storage failure category safely');
includes(app, 'storage status', 'dev diagnostics must expose storage status safely');
includes(app, 'storage code', 'dev diagnostics must expose storage code safely');
includes(app, 'retry attempt', 'dev diagnostics must expose retry attempt safely');
includes(app, 'local file exists', 'dev diagnostics must expose local file existence safely');
includes(app, 'local file readable', 'dev diagnostics must expose local file readability safely');
includes(app, 'byte size', 'dev diagnostics must expose byte-size category safely');
includes(app, 'payload', 'dev diagnostics must expose payload type safely');
includes(app, 'content type', 'dev diagnostics must expose content type safely');
includes(app, 'path category', 'dev diagnostics must expose object path category safely');
includes(app, 'database after upload', 'dev diagnostics must expose whether DB sync ran after upload');
includes(app, 'failed operation', 'dev diagnostics must expose failed operation safely');
includes(app, 'target', 'dev diagnostics must expose failed logical target safely');
includes(app, 'RLS denied', 'dev diagnostics must expose RLS denial safely');
includes(app, 'user id present', 'dev diagnostics must expose user id presence safely');
includes(app, 'project id present', 'dev diagnostics must expose project id presence safely');
includes(app, 'organization id present', 'dev diagnostics must expose organization id presence safely');
includes(app, 'membership', 'dev diagnostics must expose membership result safely');
includes(app, 'rls/auth', 'dev diagnostics must expose RLS/auth detection safely');

includes(sync, "const PROJECT_PHOTOS_BUCKET = 'project-photos';", 'field update photo uploads must use the project-photos bucket');
includes(storageMigration, "('project-photos', 'project-photos', false)", 'base migration must create private project-photos bucket');
includes(authenticatedStorageMigration, "('project-photos', 'project-photos', false)", 'authenticated migration must preserve private project-photos bucket');
includes(authenticatedStorageMigration, 'to authenticated', 'signed-in users must have authenticated Storage policies');
includes(authenticatedStorageMigration, "with check (bucket_id = 'project-photos')", 'authenticated upload policy must target project-photos bucket');
includes(authenticatedProjectSyncMigration, 'project_updates_authenticated_write', 'authenticated users must be able to sync project updates');
includes(authenticatedProjectSyncMigration, 'projects_authenticated_read', 'authenticated users must be able to read legacy project rows');
includes(authenticatedProjectSyncMigration, 'project_areas_authenticated_read', 'authenticated users must be able to read legacy project areas');
includes(authenticatedProjectSyncMigration, 'reference_documents_authenticated_write', 'authenticated users must be able to sync reference documents');
includes(authenticatedProjectSyncMigration, 'schedule_items_authenticated_write', 'authenticated users must be able to sync schedule items');
includes(ownerRestrictedProjectSyncMigration, 'app_private.dave_app_owner', 'latest sync migration must configure one fail-closed app owner');
includes(ownerRestrictedProjectSyncMigration, 'owner_id = (select auth.uid())', 'latest sync policies must isolate every row to the active owner');
includes(ownerRestrictedProjectSyncMigration, "revoke all on table public.%I from public, anon", 'latest sync migration must revoke anonymous table access');
includes(ownerRestrictedProjectSyncMigration, "bucket_id = 'project-photos' and (select public.dave_is_app_owner())", 'latest photo storage policy must be owner-only');
includes(ownerRestrictedProjectSyncMigration, "bucket_id = 'project-documents' and (select public.dave_is_app_owner())", 'latest document storage policy must be owner-only');
assert(!/using\s*\(\s*true\s*\)/i.test(ownerRestrictedProjectSyncMigration), 'latest sync migration must not use globally permissive read policies');
assert(!/with\s+check\s*\(\s*true\s*\)/i.test(ownerRestrictedProjectSyncMigration), 'latest sync migration must not use globally permissive write policies');
includes(sync, 'bucket_missing', 'missing bucket must have a safe storage category');
includes(sync, 'rls_denied', 'Storage RLS failures must have a safe category');
includes(sync, 'auth_missing', 'Storage auth failures must have a safe category');
includes(sync, 'file_unreadable', 'Storage file-read failures must have a safe category');
includes(sync, 'stale_local_uri', 'stale local photo retry must have a safe category');
includes(sync, 'invalid_path', 'invalid object paths must have a safe category');
includes(sync, 'invalid_payload', 'invalid upload payloads must have a safe category');
includes(sync, 'unsupported_content_type', 'unsupported MIME types must have a safe category');
includes(app, "if (category === 'auth_missing') return 'auth';", 'storage auth failures must route to auth UI');
includes(app, "if (category === 'rls_denied') return 'rls_denied';", 'storage RLS failures must route to permission UI');
includes(app, "if (category === 'network') return 'offline';", 'storage network failures must route to queued/offline UI');
includes(sync, 'isPhotoFileAvailable', 'retry must inspect local photo files before upload');
includes(sync, "byteSizeCategory: 'zero'", 'zero-byte files must be diagnosed before upload');
includes(sync, "uploadPayloadType: 'ArrayBuffer'", 'mobile upload diagnostics must record ArrayBuffer payloads');
includes(sync, 'photoObjectPathCategory', 'object paths must be categorized without exposing full path');
includes(sync, 'Project update database select failed', 'project update metadata permission failures must identify failed operation');
includes(sync, 'Project update database upsert failed', 'project update upsert permission failures must identify failed operation');
includes(app, 'project_update_metadata_select', 'database select failure must map to safe operation diagnostic');
includes(app, 'project_update_upsert', 'database upsert failure must map to safe operation diagnostic');
includes(app, "'missing_or_denied'", 'authenticated user without membership must map to missing_or_denied');
includes(supabase, 'base64ToArrayBuffer(base64)', 'mobile upload payload must convert local file base64 to binary bytes');
includes(supabase, 'contentType', 'mobile upload must send content type to Supabase Storage');
includes(supabase, 'errorRecord.statusCode', 'storage upload must preserve safe status code when available');
includes(supabase, 'errorRecord.code', 'storage upload must preserve safe Supabase error code when available');

includes(app, 'mergeSavedUpdatesWithTombstones', 'local/cloud update merge must honor tombstones');
assert(
  app.indexOf('localUpdates.forEach') < app.indexOf('cloudUpdates.forEach'),
  'local updates must win over stale cloud rows when deduping',
);
includes(app, 'DELETED_UPDATES_STORAGE_KEY', 'deleted update tombstones must persist in AsyncStorage');
includes(app, 'DELETED_PROJECTS_STORAGE_KEY', 'deleted project tombstones must persist in AsyncStorage');
includes(app, "item.entity === 'project' && item.operation === 'delete'", 'pending project deletes must become startup tombstones before cloud hydration');
includes(app, 'markProjectDeleted(projectName)', 'permanent project deletion must record its tombstone');
includes(app, 'mergeProjectRecords(\n        starterProjects,', 'startup project merging must apply the durable deletion filter');
includes(app, 'const starterProjects = localResult.found ? [] : DEFAULT_PROJECTS;', 'starter projects must only seed a new installation or a recovered corrupt project store');
includes(app, 'item.scheduleProjectName?.toLowerCase() !== projectName.toLowerCase()', 'deleting a parent project must remove its child schedule rows');
includes(app, "if (tombstone && !localArchiveCanStayHidden) return;", 'cloud/local merge must not resurrect tombstoned updates');
includes(app, 'removeProjectUpdateFromSyncQueue(tombstone.updateId)', 'startup load must remove tombstoned updates from pending sync queue before cloud load');
includes(app, 'await removeMissingPhotosFromSyncQueue(missingPhotos);', 'missing local photo cleanup must target only the retry queue');
const missingPhotoCleanup = app.slice(
  app.indexOf('async function removeMissingSyncPhotos'),
  app.indexOf('function beginDraftForProject'),
);
includes(missingPhotoCleanup, 'markMissingPhotosUnavailable', 'missing local photo cleanup must preserve the record while marking only its unavailable file');
includes(missingPhotoCleanup, 'AsyncStorage.setItem(UPDATES_STORAGE_KEY', 'the unavailable-file decision must survive restart');
includes(app, 'syncFieldUpdateWithMissingPhotoRepair', 'background and manual retry must repair definitive missing-photo loops once');
includes(sync, "cloudRecoveryStatus: 'unavailable' as const", 'unrecoverable files must retain explicit provenance instead of being deleted from history');
includes(sync, "photo.cloudRecoveryStatus === 'unavailable'", 'confirmed unavailable files must not be queued forever');
includes(app, 'label="Delete Saved Update"', 'resumed saved updates must expose an in-flow delete action');
includes(app, 'onDeleteUpdate={resumedSavedDraft ? deleteResumedSavedDraft : undefined}', 'delete action must only appear while editing an existing saved update');
includes(app, "...(draft.id === updateId ? [] : [draft])", 'deleting a resumed update must not keep its photos alive through the active draft reference');
includes(sync, 'export async function removeMissingPhotosFromSyncQueue', 'queue-only missing photo cleanup must remain available');
includes(app, 'orphanedPhotoCountIgnored: update.photos.length', 'failed update tombstones must record ignored orphaned photo metadata');
includes(app, 'projectRollupKey(update.projectName)', 'project rollups must normalize saved update project names');
includes(app, "photo.cloudRecoveryStatus === 'unavailable'", 'a repaired missing-photo update with a stale failed label must automatically finalize');
includes(app, 'projectStatsForName(projectStatsByName, project)', 'project card must use normalized local-first stats');
includes(app, 'projectStatsForUpdates(projectUpdates)', 'parent workspace must aggregate local-first stats across its child scope');
includes(app, 'projectMatchesScope(update, projectName)', 'workspace/activity filters must use normalized project matching');
includes(app, 'Rollup source: local-first saved updates | queued included: yes | workspace/card shared: yes', 'dev diagnostics must show shared local-first rollup source');
includes(app, '1 update pending sync', 'project card must show pending sync when queued local updates exist');
includes(app, 'Last local update', 'project card must not say no recent updates for local queued updates');

const projectCard = app.slice(app.indexOf('function Phase2ProjectCard'), app.indexOf('function ProjectWorkspaceScreen'));
assert(!projectCard.includes('All projects on track — nothing needs your attention.'), 'project card must not render all-project empty-state copy');
assert(!projectCard.includes('Needs Review'), 'project card status must not use Needs Review');

includes(sync, 'id: projectUpdateQueueItemId(update.id)', 'queued update retry must remain idempotent');
includes(admin, 'getSyncStatus()', 'Settings must read the durable offline sync queue status');
includes(admin, 'title="Cloud sync"', 'Settings must surface sync status outside developer diagnostics');
includes(admin, "'All caught up'", 'Settings must clearly identify an empty sync queue');
includes(admin, 'waiting to sync', 'Settings must clearly identify pending sync work');
includes(admin, 'label={isSyncing ? \'Syncing…\' : \'Retry Sync\'}', 'pending sync work must expose a guarded retry action');
includes(supabase, 'export async function listArchivedProjects', 'archived cloud projects must be queryable for recovery and reopening');
includes(projectService, 'loadCloudArchivedProjectNames', 'project loading must include archived cloud project names');
includes(app, 'setCloudProjectArchived(projectName, true)', 'archiving a project must persist to cloud sync');
includes(app, 'setCloudProjectArchived(projectName, false)', 'reopening a project must persist to cloud sync');
includes(app, 'label="Archive Project"', 'the live project workspace must expose the archive path');
includes(app, 'Archived Projects', 'the live Projects screen must expose archived projects for reopening');
assert(!app.includes('SUPABASE_SERVICE_ROLE_KEY'), 'mobile app must not reference service-role env');
assert(!app.includes('EXPO_PUBLIC_OPENAI_API_KEY'), 'mobile app must not reference public OpenAI API key');
assert(!app.match(/service[_-]?role/i), 'mobile app must not contain service-role references');
includes(pkg, 'local-sync-consistency-test.js', 'test:ui must run local/sync consistency regression');
includes(pkg, 'dev:create-project-member', 'package must expose local-only project membership setup command');
includes(pkg, 'dev:storage-smoke-test', 'package must expose normal-user storage smoke test command');
includes(membershipSetup, "const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];", 'membership setup must require local service-role env');
includes(membershipSetup, 'service.auth.admin.listUsers', 'membership setup must find the Supabase Auth user server-side');
includes(membershipSetup, "from('organization_memberships')", 'membership setup must create organization membership rows');
includes(membershipSetup, "const areaName = String(args['area-name'] || '').trim();", 'membership setup must accept an area name');
includes(membershipSetup, 'findOrganizationForProjectName', 'membership setup must resolve organization by project name');
includes(membershipSetup, 'findOrganizationForAreaName', 'membership setup must resolve organization by area name');
includes(membershipSetup, 'organizationIdFromRecord', 'membership setup must resolve organization id from project/area JSON');
includes(membershipSetup, "'project_manager'", 'membership setup default role must allow sync permission');
includes(storageSmoke, "const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];", 'storage smoke test must use anon user auth env only');
includes(storageSmoke, 'signInWithPassword', 'storage smoke test must sign in as a normal Supabase user');
includes(storageSmoke, "const bucket = 'project-photos';", 'storage smoke test must target project-photos bucket');
includes(storageSmoke, 'object path category: project/update/photo-file', 'storage smoke test must report path category without full path');
includes(storageSmoke, '.remove([path])', 'storage smoke test must clean up successful uploads');
assert(!storageSmoke.includes('SUPABASE_SERVICE_ROLE_KEY'), 'storage smoke test must not use service-role env');

console.log('Local sync consistency tests passed.');
