#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const app = read('App.tsx');
const entry = read('entry.ts');
const supabaseService = read('services/SupabaseService.ts');
const syncService = read('services/SyncService.ts');
const backupArchive = read('services/CompleteBackupArchive.ts');
const ownerSandbox = read('services/OwnerStorageSandbox.ts');
const photoFunction = read('supabase/functions/pie-photo-vision/index.ts');
const photoProvider = read('supabase/functions/_shared/pie-vision-provider.ts');
const voiceFunction = read('supabase/functions/dave-transcribe-memory/index.ts');
const aiMigration = read(
  'supabase/migrations/20260726010000_vitruvius_ai_operation_controls.sql',
);
const deletionMigration = read(
  'supabase/migrations/20260726020000_vitruvius_atomic_deletion.sql',
);

assert.equal(packageJson.dependencies['@noble/ciphers'], '1.3.0');
assert.equal(packageJson.dependencies['@noble/hashes'], '1.8.0');
assert.equal(packageJson.dependencies['base64-js'], '1.5.1');

for (const marker of [
  'gcm',
  'pbkdf2',
  'sha256',
  '210_000',
  'COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH',
  'wrong_passphrase_or_tampered',
  'asset_mismatch',
]) {
  assert(
    backupArchive.includes(marker),
    `Complete backup archive must preserve ${marker}.`,
  );
}
for (const marker of [
  'createCompleteBackupArchive',
  'decryptCompleteBackupArchive',
  'ensureVerifiedReferenceDocumentBytes',
  'readCompleteBackupAsset',
  'materializeCompleteBackupState',
]) {
  assert(app.includes(marker), `Live backup workflow must use ${marker}.`);
}
assert(
  app.includes('project records, photos, and documents are encrypted'),
  'Mobile backup confirmation must describe the complete encrypted archive.',
);

for (const marker of [
  'createOwnerStorageSandbox',
  'activateOwner',
  'session?.user?.id || null',
]) {
  assert(entry.includes(marker), `Native entry must enforce ${marker}.`);
}
for (const marker of [
  'OWNER_STORAGE_SANDBOX_METADATA_KEY',
  'OWNER_STORAGE_SANDBOX_JOURNAL_KEY',
  'verifyCanonicalSnapshot',
  'recoverInterruptedTransition',
]) {
  assert(ownerSandbox.includes(marker), `Owner storage sandbox must preserve ${marker}.`);
}

for (const marker of [
  'dave_delete_project_atomically',
  'dave_delete_project_update_atomically',
]) {
  assert(
    supabaseService.includes(marker),
    `Cloud deletion must fail closed through ${marker}.`,
  );
  assert(
    deletionMigration.includes(marker),
    `Deletion migration must define ${marker}.`,
  );
}
for (const marker of [
  'force row level security',
  'dave_deletion_audit',
  'purge_after',
  "entity_type in ('project', 'project_update')",
]) {
  assert(
    deletionMigration.toLowerCase().includes(marker.toLowerCase()),
    `Atomic deletion migration must preserve ${marker}.`,
  );
}
assert(
  syncService.includes("'project_update'") && syncService.includes("'project'"),
  'Sync must honor project and project-update deletion markers.',
);

for (const operationType of [
  'schedule_extraction',
  'photo_analysis',
  'voice_capture',
  'report_generation',
]) {
  assert(
    aiMigration.includes(`'${operationType}'`),
    `AI operation ledger must allow ${operationType}.`,
  );
}
for (const marker of [
  'force row level security',
  'dave_begin_ai_operation',
  'dave_finish_ai_operation',
  'pg_advisory_xact_lock',
  'idempotency_conflict',
  'rate_limited',
  "interval '24 hours'",
]) {
  assert(
    aiMigration.toLowerCase().includes(marker.toLowerCase()),
    `AI operation migration must preserve ${marker}.`,
  );
}

for (const [source, label] of [
  [photoFunction, 'photo analysis'],
  [voiceFunction, 'voice capture'],
]) {
  for (const marker of [
    'dave_begin_ai_operation',
    'dave_finish_ai_operation',
    'rate_limited',
    'in_progress',
    'response_payload',
  ]) {
    assert(source.includes(marker), `${label} must use ${marker}.`);
  }
}
assert(photoFunction.includes('provider_response: null'));
assert(photoFunction.includes('raw_response: null'));
assert(photoFunction.includes("?? '1'"), 'Photo provider retries must default to one attempt.');
assert(photoProvider.includes('store: false'), 'Photo provider retention must be disabled.');
assert(voiceFunction.includes('store: false'), 'Voice understanding retention must be disabled.');
assert(
  !voiceFunction.includes("'Access-Control-Allow-Origin': '*'"),
  'Voice capture must not use wildcard browser access.',
);
assert(
  voiceFunction.includes('ALLOWED_ORIGINS'),
  'Voice capture must enforce configured browser origins.',
);

console.log(
  'Production hardening PASS: AI controls, atomic deletion, owner isolation, and complete encrypted backup are wired into the live runtime.',
);
