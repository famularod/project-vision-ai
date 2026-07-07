#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

function includes(source, marker, message) {
  assert(source.includes(marker), message);
}

includes(app, 'FieldUpdateSyncDiagnostics', 'updates must persist safe sync diagnostics');
includes(app, 'lastSyncFailureCategory', 'sync diagnostics must include safe failure category');
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
includes(app, "Sync failed · Retry", 'online sync failure must show retryable copy');
includes(app, "Queued — will send when you're back online", 'offline queued copy must be specific');
includes(app, 'onRetry={updateCanInlineRetry(update) ? () => retryUpdate(update) : undefined}', 'queued/failed cards must expose retry');
includes(app, 'void hydrateQueuedUpdates();', 'sync worker must run after save/sign-in or queue wake-up');
includes(app, "AppState.addEventListener('change'", 'sync worker must run on app foreground');

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
assert(!app.includes('EXPO_PUBLIC_OPENAI_API_KEY'), 'mobile app must not reference public OpenAI API key');
assert(!app.match(/service[_-]?role/i), 'mobile app must not contain service-role references');
includes(pkg, 'local-sync-consistency-test.js', 'test:ui must run local/sync consistency regression');

console.log('Local sync consistency tests passed.');
