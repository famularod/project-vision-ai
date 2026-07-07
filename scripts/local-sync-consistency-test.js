#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
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
includes(app, 'statusForSyncDiagnostics', 'sync result must decide sent/queued/failed state');
includes(app, "if (diagnostics.lastSyncFailureCategory === 'offline') return 'queued';", 'only offline failures should remain queued');
includes(app, "return 'failed';", 'online sync failures should become failed and retryable');
includes(app, "Sign in required to send", 'signed-out send state must be explicit');
includes(app, "Session expired · Sign in again", 'expired/auth send state must ask for sign-in again');
includes(app, "Sync failed · Permission issue", 'RLS failures must use permission copy');
includes(app, "Project access required to sync", 'missing project membership must use project access copy');
includes(app, "Photo unavailable · retake or replace photo", 'stale local photos must not show generic upload copy');
includes(app, "Sync failed · Photo upload issue", 'storage failures must use photo upload copy');
includes(app, "Sync failed · Update save issue", 'database failures must use update save copy');
includes(app, "Sync failed · App data issue", 'malformed payload failures must use app data copy');
includes(app, "Sync failed · Retry", 'online sync failure must show retryable copy');
includes(app, "Queued — will send when you're back online", 'offline queued copy must be specific');
includes(app, 'onRetry={updateCanInlineRetry(update) ? () => retryUpdate(update) : undefined}', 'queued/failed cards must expose retry');
includes(app, 'void hydrateQueuedUpdates();', 'sync worker must run after save/sign-in or queue wake-up');
includes(app, "AppState.addEventListener('change'", 'sync worker must run on app foreground');
includes(app, 'runFieldUpdateCloudSync', 'send/retry must run structured cloud sync work');
includes(app, 'update.photos.map(photo => uploadLocalPhotoWithDiagnostics(update, photo))', 'sync retry must await photo upload work with diagnostics');
includes(app, 'await saveCloudUpdate(update)', 'sync retry must queue the update for cloud insert/update');
includes(app, 'await uploadPendingChanges()', 'sync retry must attempt database insert/update work');
assert(
  app.indexOf('const tokenResult = await getCurrentSessionAccessToken();') <
    app.indexOf('const { syncResult, workAttempt } = await runFieldUpdateCloudSync(queuedUpdate);'),
  'send must fetch fresh session state before invoking sync work',
);
const retryStart = app.indexOf('async function retryQueuedUpdate');
assert(
  app.indexOf('const tokenResult = await getCurrentSessionAccessToken();', retryStart) <
    app.indexOf('const { syncResult, workAttempt } = await runFieldUpdateCloudSync(retryUpdate);', retryStart),
  'retry must fetch fresh session state before invoking sync work',
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
includes(sync, 'inspectPhotoFileForUpload', 'retry must inspect local photo files before upload');
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

includes(app, '...localUpdates,', 'local updates must be merged before cloud updates');
assert(
  app.indexOf('...localUpdates,') < app.indexOf('...cloudUpdates.map(normalizeUpdate),'),
  'local updates must win over stale cloud rows when deduping',
);
includes(app, 'projectRollupKey(update.projectName)', 'project rollups must normalize saved update project names');
includes(app, 'projectStatsForName(projectStatsByName, project)', 'project card must use normalized local-first stats');
includes(app, 'projectStatsForName(projectStatsByName, selectedWorkspaceProject)', 'workspace must use the same stats source as project card');
includes(app, 'projectMatchesScope(update, projectName)', 'workspace/activity filters must use normalized project matching');
includes(app, 'Rollup source: local-first saved updates | queued included: yes | workspace/card shared: yes', 'dev diagnostics must show shared local-first rollup source');
includes(app, '1 update pending sync', 'project card must show pending sync when queued local updates exist');
includes(app, 'Last local update', 'project card must not say no recent updates for local queued updates');

const projectCard = app.slice(app.indexOf('function Phase2ProjectCard'), app.indexOf('function ProjectWorkspaceScreen'));
assert(!projectCard.includes('All projects on track — nothing needs your attention.'), 'project card must not render all-project empty-state copy');
assert(!projectCard.includes('Needs Review'), 'project card status must not use Needs Review');

includes(sync, "id: `project-update-${update.id}`", 'queued update retry must remain idempotent');
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
